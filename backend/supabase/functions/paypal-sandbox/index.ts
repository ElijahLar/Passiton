import { handleRequest } from './handler.mjs';

Deno.serve((request: Request) => handleRequest(request, { env: Deno.env.toObject() }));
