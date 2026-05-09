import net from 'node:net';

const client = net.createConnection({ host: '127.0.0.1', port: 2525 });

const commands = [
  'EHLO localhost',
  'MAIL FROM:<tester@example.com>',
  'RCPT TO:<smtpcheck@ffaaffai.asia>',
  'DATA',
  'From: tester@example.com',
  'To: smtpcheck@ffaaffai.asia',
  'Subject: SMTP test 246810',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Your verification code is 246810.',
  '.',
  'QUIT'
];

let step = 0;
let dataMode = false;
let buffer = '';

function sendNext() {
  if (step >= commands.length) return;
  const line = commands[step++];
  client.write(`${line}\r\n`);
}

client.on('connect', () => {
  console.log('connected');
});

client.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line) continue;
    console.log(`S: ${line}`);
    const code = Number(line.slice(0, 3));
    if (Number.isNaN(code)) continue;

    if (code === 220) {
      sendNext();
      continue;
    }

    if (dataMode) {
      if (code === 250) {
        dataMode = false;
        sendNext();
      }
      continue;
    }

    if ([250, 251].includes(code)) {
      sendNext();
      continue;
    }

    if (code === 354) {
      dataMode = true;
      while (step < commands.length) {
        const lineToSend = commands[step++];
        client.write(`${lineToSend}\r\n`);
        if (lineToSend === '.') break;
      }
      continue;
    }

    if (code === 221) {
      client.end();
    }
  }
});

client.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

client.on('end', () => {
  console.log('disconnected');
});
