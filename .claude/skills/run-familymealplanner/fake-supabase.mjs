#!/usr/bin/env node
// A local stand-in for Supabase, just big enough to run the meal planner UI
// with no Supabase project, no Docker and no email inbox.
//
//   node .claude/skills/run-familymealplanner/fake-supabase.mjs   (listens on :54321)
//
// - Postgres: in-process PGlite (already a devDependency), loaded with every
//   migration, supabase/seed.sql and supabase/data/*.sql. Fresh on every start.
// - /rest/v1: the slice of PostgREST that postgrest-js uses in this app
//   (select with one level of embeds, eq/neq/gt/gte/lt/lte/like/ilike/is/in/not,
//   order, limit, offset, insert, upsert, update, delete, Prefer/Accept headers).
//   Every request runs as role `authenticated` with the JWT's email in
//   request.jwt.claims, so the real row-level security policies apply.
// - /auth/v1: magic links without email. /otp prints the link to stdout;
//   /verify accepts the email itself as token_hash. Sign in by opening
//   http://localhost:3000/auth/confirm?token_hash=<email>&type=email
//
// Env: PORT (54321), MEMBER_EMAIL (cook@example.com, added to the household).

import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PORT = Number(process.env.PORT ?? 54321);
const MEMBER = (process.env.MEMBER_EMAIL ?? "cook@example.com").toLowerCase();
const APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3000";

// ---------------------------------------------------------------- database
const db = new PGlite();
const sqlFile = (...p) => readFileSync(join(ROOT, ...p), "utf8");
await db.exec(`
  create schema if not exists auth;
  create or replace function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  grant usage on schema public, auth to authenticated, anon;
`);
for (const f of readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort())
  await db.exec(sqlFile("supabase/migrations", f));
await db.exec(sqlFile("supabase/seed.sql"));
for (const f of ["meal_names.sql", "meal_images.sql"]) await db.exec(sqlFile("supabase/data", f));
await db.exec(`
  grant select, insert, update, delete on all tables in schema public to authenticated, anon;
  grant usage on all sequences in schema public to authenticated, anon;
  insert into public.household_members (household_id, email)
    select id, '${MEMBER.replace(/'/g, "''")}' from public.households on conflict do nothing;
`);

// column types (for casting text params) and foreign keys (for embeds)
const colTypes = new Map(); // table -> Map(col -> type)
for (const r of (
  await db.query(`select c.relname t, a.attname c, format_type(a.atttypid, a.atttypmod) ty
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`)
).rows) {
  if (!colTypes.has(r.t)) colTypes.set(r.t, new Map());
  colTypes.get(r.t).set(r.c, r.ty);
}
const fks = (
  await db.query(`select cl.relname src, a.attname src_col, rf.relname dst, af.attname dst_col
    from pg_constraint k join pg_class cl on cl.oid = k.conrelid join pg_class rf on rf.oid = k.confrelid
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
    where k.contype = 'f' and array_length(k.conkey, 1) = 1`)
).rows;

// ---------------------------------------------------------------- helpers
const ident = (s) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw httpErr(400, "PGRST100", `bad identifier ${s}`);
  return `"${s}"`;
};
function httpErr(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const fromB64url = (s) => JSON.parse(Buffer.from(s, "base64url").toString());

function userFor(email) {
  const id = "00000000-0000-4000-8000-" + Buffer.from(email).toString("hex").padEnd(12, "0").slice(0, 12);
  return {
    id, aud: "authenticated", role: "authenticated", email,
    email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "email" }, user_metadata: {},
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}
function sessionFor(email) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 7 * 24 * 3600;
  const user = userFor(email);
  const claims = { sub: user.id, email, role: "authenticated", aud: "authenticated", iat: now, exp };
  const access_token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.fake-signature`;
  return { access_token, token_type: "bearer", expires_in: exp - now, expires_at: exp, refresh_token: `rt-${b64url({ email })}`, user };
}
function claimsFrom(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return null;
  try {
    const c = fromB64url(m[1].split(".")[1]);
    return c.email ? c : null; // the anon key carries no email
  } catch {
    return null;
  }
}

// split "a,b(c,d),e" on top-level commas
function splitTop(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// build the projection for `select=` against alias `src` of table `table`
function projection(table, select, src) {
  const items = splitTop(select || "*");
  return items
    .map((it) => {
      const m = /^(?:(\w+):)?(\w+)(?:!\w+)?\((.*)\)$/.exec(it);
      if (!m) {
        if (it === "*") return `${src}.*`;
        const [name, alias] = it.includes(":") ? it.split(":").reverse() : [it, it];
        return `${src}.${ident(name)} as ${ident(alias)}`;
      }
      const [, alias, rel, inner] = m;
      const sub = `e_${rel}`;
      const many2one = fks.find((f) => f.src === table && f.dst === rel);
      if (many2one) {
        return `(select row_to_json(x) from (select ${projection(rel, inner, sub)} from public.${ident(rel)} ${sub}
          where ${sub}.${ident(many2one.dst_col)} = ${src}.${ident(many2one.src_col)}) x) as ${ident(alias ?? rel)}`;
      }
      const one2many = fks.find((f) => f.src === rel && f.dst === table);
      if (one2many) {
        return `coalesce((select json_agg(x) from (select ${projection(rel, inner, sub)} from public.${ident(rel)} ${sub}
          where ${sub}.${ident(one2many.src_col)} = ${src}.${ident(one2many.dst_col)}) x), '[]') as ${ident(alias ?? rel)}`;
      }
      throw httpErr(400, "PGRST200", `no relationship between ${table} and ${rel}`);
    })
    .join(", ");
}

// cast a JS value to text for `$n::type`
function toPgText(v, type) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v) && type?.endsWith("[]"))
    return "{" + v.map((x) => (x === null ? "NULL" : `"${String(x).replace(/["\\]/g, "\\$&")}"`)).join(",") + "}";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
function whereClause(table, params, args) {
  const conds = [];
  for (const [col, raw] of params) {
    if (RESERVED.has(col)) continue;
    const c = ident(col);
    let expr = raw, neg = false;
    if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
    const dot = expr.indexOf(".");
    const op = expr.slice(0, dot), val = expr.slice(dot + 1);
    const p = (v) => { args.push(v); return `$${args.length}`; };
    let sql;
    switch (op) {
      case "eq": sql = `${c}::text = ${p(val)}`; break;
      case "neq": sql = `${c}::text <> ${p(val)}`; break;
      case "gt": case "gte": case "lt": case "lte": {
        const ty = colTypes.get(table)?.get(col) ?? "text";
        sql = `${c} ${{ gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]} ${p(val)}::${ty}`;
        break;
      }
      case "like": sql = `${c}::text like ${p(val.replace(/\*/g, "%"))}`; break;
      case "ilike": sql = `${c}::text ilike ${p(val.replace(/\*/g, "%"))}`; break;
      case "is": {
        const v = { null: "null", true: "true", false: "false", unknown: "unknown" }[val.toLowerCase()];
        if (!v) throw httpErr(400, "PGRST100", `bad is value ${val}`);
        sql = `${c} is ${v}`;
        break;
      }
      case "in": {
        const list = splitTop(val.replace(/^\(|\)$/g, "")).map((x) => x.replace(/^"|"$/g, ""));
        sql = `${c}::text = any(${p(list)}::text[])`;
        break;
      }
      default:
        throw httpErr(400, "PGRST100", `operator ${op} not supported by fake-supabase`);
    }
    conds.push(neg ? `not (${sql})` : sql);
  }
  return conds.length ? `where ${conds.join(" and ")}` : "";
}

function orderLimit(params, args) {
  let sql = "";
  const order = params.get("order");
  if (order) {
    sql += " order by " + order.split(",").map((o) => {
      const [col, ...mods] = o.split(".");
      const dir = mods.includes("desc") ? "desc" : "asc";
      const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
      return `${ident(col)} ${dir}${nulls}`;
    }).join(", ");
  }
  if (params.get("limit")) { args.push(Number(params.get("limit"))); sql += ` limit $${args.length}`; }
  if (params.get("offset")) { args.push(Number(params.get("offset"))); sql += ` offset $${args.length}`; }
  return sql;
}

async function rest(req, url, body) {
  const table = url.pathname.replace(/^\/rest\/v1\//, "");
  if (!colTypes.has(table)) throw httpErr(404, "42P01", `relation "public.${table}" does not exist`);
  const params = url.searchParams;
  const prefer = req.headers.prefer ?? "";
  const wantRows = req.method === "GET" || prefer.includes("return=representation");
  const proj = projection(table, params.get("select"), "t");
  const types = colTypes.get(table);
  const args = [];
  const T = `public.${ident(table)}`;
  let sql;

  if (req.method === "GET" || req.method === "HEAD") {
    sql = `with r as (select ${proj} from ${T} t ${whereClause(table, params, args)}${orderLimit(params, args)})`;
  } else if (req.method === "POST") {
    const rows = Array.isArray(body) ? body : [body];
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const values = rows.map((r) => "(" + cols.map((c) => {
      if (!(c in r)) return "default";
      args.push(toPgText(r[c], types.get(c)));
      return `$${args.length}::${types.get(c) ?? "text"}`;
    }).join(", ") + ")").join(", ");
    let conflict = "";
    const oc = params.get("on_conflict");
    if (oc && prefer.includes("resolution=merge-duplicates")) {
      const keys = oc.split(",").map(ident);
      const upd = cols.filter((c) => !oc.split(",").includes(c)).map((c) => `${ident(c)} = excluded.${ident(c)}`);
      conflict = ` on conflict (${keys.join(", ")}) do ${upd.length ? "update set " + upd.join(", ") : "nothing"}`;
    } else if (prefer.includes("resolution=ignore-duplicates")) {
      conflict = " on conflict do nothing";
    }
    sql = `with t as (insert into ${T} (${cols.map(ident).join(", ")}) values ${values}${conflict} returning *), r as (select ${proj} from t)`;
  } else if (req.method === "PATCH") {
    const sets = Object.entries(body).map(([c, v]) => {
      args.push(toPgText(v, types.get(c)));
      return `${ident(c)} = $${args.length}::${types.get(c) ?? "text"}`;
    });
    sql = `with t as (update ${T} set ${sets.join(", ")} ${whereClause(table, params, args)} returning *), r as (select ${proj} from t)`;
  } else if (req.method === "DELETE") {
    sql = `with t as (delete from ${T} ${whereClause(table, params, args)} returning *), r as (select ${proj} from t)`;
  } else throw httpErr(405, "PGRST000", `method ${req.method}`);

  const claims = claimsFrom(req);
  const rows = await db.transaction(async (tx) => {
    await tx.query(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`, [
      claims ? "authenticated" : "anon",
      JSON.stringify(claims ?? { role: "anon" }),
    ]);
    await tx.exec(`set local role ${claims ? "authenticated" : "anon"}`);
    // let Postgres write the JSON so dates, timestamps and numerics look like PostgREST's
    const r = await tx.query(`${sql} select coalesce(json_agg(r), '[]')::text as j from r`, args);
    return JSON.parse(r.rows[0].j);
  });

  const status = req.method === "POST" ? 201 : wantRows ? 200 : 204;
  const headers = { "content-range": `0-${Math.max(rows.length - 1, 0)}/*` };
  if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
    if (rows.length !== 1)
      return [406, headers, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null }];
    return [status === 204 ? 200 : status, headers, rows[0]];
  }
  return [status, headers, wantRows ? rows : undefined];
}

async function auth(req, url, body) {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  if (path === "/otp" && req.method === "POST") {
    const email = String(body.email ?? "").toLowerCase();
    console.log(`[fake-supabase] magic link for ${email}: ${APP_ORIGIN}/auth/confirm?token_hash=${encodeURIComponent(email)}&type=email`);
    return [200, {}, {}];
  }
  if (path === "/verify" && req.method === "POST") {
    const email = String(body.token_hash ?? body.email ?? "").toLowerCase();
    if (!email.includes("@")) return [403, {}, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" }];
    const s = sessionFor(email);
    return [200, {}, { ...s, session: s }];
  }
  if (path === "/token" && url.searchParams.get("grant_type") === "refresh_token") {
    try {
      const { email } = fromB64url(String(body.refresh_token).replace(/^rt-/, ""));
      return [200, {}, sessionFor(email)];
    } catch {
      return [400, {}, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }];
    }
  }
  if (path === "/user" && req.method === "GET") {
    const c = claimsFrom(req);
    if (!c) return [401, {}, { code: 401, error_code: "no_authorization", msg: "This endpoint requires a valid Bearer token" }];
    return [200, {}, userFor(c.email)];
  }
  if (path === "/logout") return [204, {}, undefined];
  if (path === "/settings") return [200, {}, { external: { email: true }, disable_signup: false }];
  return [404, {}, { code: 404, msg: `fake-supabase has no ${req.method} ${path}` }];
}

// ---------------------------------------------------------------- server
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-expose-headers": "content-range",
};
createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let chunks = "";
  for await (const c of req) chunks += c;
  let status = 500, headers = {}, payload;
  try {
    if (req.method === "OPTIONS") [status, payload] = [204, undefined];
    else {
      const body = chunks ? JSON.parse(chunks) : {};
      if (url.pathname.startsWith("/rest/v1/")) [status, headers, payload] = await rest(req, url, body);
      else if (url.pathname.startsWith("/auth/v1/")) [status, headers, payload] = await auth(req, url, body);
      else [status, payload] = [404, { msg: "not found" }];
    }
  } catch (e) {
    status = e.status ?? (e.code === "23505" ? 409 : e.code === "42501" ? 403 : 400);
    payload = { code: e.code ?? "XX000", message: e.message, details: e.detail ?? null, hint: e.hint ?? null };
  }
  if (process.env.FAKE_SUPABASE_LOG !== "0")
    console.log(`[fake-supabase] ${req.method} ${url.pathname}${url.search.length > 80 ? url.search.slice(0, 80) + "…" : url.search} -> ${status}`);
  res.writeHead(status, { ...CORS, ...headers, ...(payload !== undefined ? { "content-type": "application/json" } : {}) });
  res.end(payload !== undefined ? JSON.stringify(payload) : undefined);
}).listen(PORT, () => console.log(`[fake-supabase] ready on http://localhost:${PORT} (household member: ${MEMBER})`));
