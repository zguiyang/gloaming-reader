export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /** Hono API origin for Next server-side /api rewrites and logout BFF. Required. */
      API_INTERNAL_URL: string;
    }
  }
}
