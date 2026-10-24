/** Public frontend configuration. Room operations remain on the durable game service. */
export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (!['GET','HEAD'].includes(request.method)) {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.end(JSON.stringify({error:'Use GET for frontend configuration.'}));
    return;
  }
  const host = request.headers.host;
  if (typeof host !== 'string' || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    response.statusCode = 400;
    response.end(JSON.stringify({error:'Invalid frontend host.'}));
    return;
  }
  const local = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host);
  const joinOrigin = new URL(`${local?'http':'https'}://${host}`).origin;
  response.statusCode = 200;
  response.end(request.method === 'HEAD' ? undefined : JSON.stringify({joinOrigin,pollInterval:1000,online:true}));
}
