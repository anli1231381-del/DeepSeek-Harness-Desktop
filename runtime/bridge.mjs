import { createInterface } from 'node:readline';
import { createController } from './core.mjs';

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const controller = await createController({ stateFile: process.argv[2], resourceRoot: process.argv[3], onChanged: () => send({ event: 'changed' }) });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();
input.on('line', line => {
  chain = chain.then(async () => {
    let request;
    try {
      if (line.length > 100000) throw new Error('请求过长');
      request = JSON.parse(line);
      const result = await controller.dispatch(request.operation, request.params);
      send({ id: request.id, result });
    } catch (error) { send({ id: request?.id ?? null, error: String(error.message).replace(/\bsk-[\w-]+/g, '[已隐藏凭证]') }); }
  });
});
input.on('close', () => { chain.then(() => controller.close()).finally(() => process.exit(0)); });
