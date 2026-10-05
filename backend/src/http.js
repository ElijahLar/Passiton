export function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function notImplemented(response, feature) {
  sendJson(response, 501, {
    error: 'NOT_IMPLEMENTED',
    message: `${feature} är ännu inte implementerat.`,
  });
}
