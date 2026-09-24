const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
/** @type {import('next').NextConfig} */
export default {
  output: "export",
  basePath,
  images: { unoptimized: true },
  trailingSlash: true,
};
