import { readFileSync } from 'node:fs';
import { Agent, request } from 'node:https';

const endpoint = 'https://appapi2.test.bankid.com/rp/v6.0/';
const certificateDirectory = new URL('./.bankid-test/', import.meta.url);

export class BankIdError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function createBankIdClient() {
  const agent = new Agent({
    keepAlive: true,
    minVersion: 'TLSv1.2',
    ca: readFileSync(new URL('BankIdApiRootCertificate-Test.crt', certificateDirectory)),
    pfx: readFileSync(new URL('FPTestcert5_20240610.p12', certificateDirectory)),
    passphrase: 'qwerty123' // Published with BankID's shared test certificate.
  });

  return (operation, data) => new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(data));
    const req = request(new URL(operation, endpoint), {
      agent,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 32_768) response.destroy(new BankIdError('responseTooLarge'));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const result = raw ? JSON.parse(raw) : {};
          if (response.statusCode !== 200) throw new BankIdError(result?.errorCode ?? 'upstreamError');
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
    const timeout = setTimeout(() => req.destroy(new BankIdError('timeout')), 8000);
    req.on('close', () => clearTimeout(timeout));
    req.on('error', reject);
    req.end(body);
  });
}
