/**
 * mammoth ships a standalone browser build without its own declarations. It
 * is the same library, so it has the same shape as the package's main entry.
 */
declare module "mammoth/mammoth.browser" {
  const mammoth: typeof import("mammoth");
  export = mammoth;
}
