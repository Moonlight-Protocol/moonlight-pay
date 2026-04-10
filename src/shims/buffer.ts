import { Buffer } from "buffer";

const g = globalThis as Record<string, unknown>;
g.__buffer_polyfill = { Buffer };
g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
if (!g.process) g.process = { env: {}, version: "", browser: true };
