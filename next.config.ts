import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The .xlsx reader for the menu sheet sync loads from node_modules as it is, not bundled.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
