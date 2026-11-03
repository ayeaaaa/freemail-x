import assert from 'node:assert/strict';
import { extractVerificationCode } from '../tools/smtp-test/extract-code.mjs';

// 真实 GitHub "launch code" 邮件（messages.id 6915036 的 text/plain 正文）
// 真码是 64441325；旧提取器返回 21735（链接里 UUID 04312798-1fd6-4724-94a8-e19e3f21735b 的片段）
const githubLaunchCodeEmail = `Here's your GitHub launch code!

Continue signing up for GitHub by entering the code below:

64441325

You can enter it by visiting the link below:

https://github.com/account_verifications?verification=04312798-1fd6-4724-94a8-e19e3f21735b&via_launch_code_email=true

You're receiving this email because you recently created a new GitHub account. If this wasn't you, please ignore this email.

Not able to enter the code? Paste the following link into your browser:

https://github.com/account_verifications/confirm/04312798-1fd6-4724-94a8-e19e3f21735b/64441325

---
Sent with <3 by GitHub.
GitHub, Inc. 88 Colin P Kelly Jr Street
San Francisco, CA 94107`;

const githubSubject = '🚀 Your GitHub launch code';

assert.equal(
  extractVerificationCode({ subject: githubSubject, text: githubLaunchCodeEmail }),
  '64441325',
  'GitHub launch code email: must return the real code 64441325'
);

assert.notEqual(
  extractVerificationCode({ subject: githubSubject, text: githubLaunchCodeEmail }),
  '21735',
  'GitHub launch code email: must not return the UUID fragment 21735'
);

assert.equal(
  extractVerificationCode({ text: 'Your verification code is 123456' }),
  '123456',
  'standard English phrasing'
);

assert.equal(
  extractVerificationCode({ text: '您的验证码：654321，5 分钟内有效' }),
  '654321',
  'Chinese phrasing'
);

assert.equal(
  extractVerificationCode({ text: 'Enter the code below:\n\n987654\n' }),
  '987654',
  'code on its own line after a keyword line'
);

assert.equal(
  extractVerificationCode({ html: '<p>Your verification code is</p><p><strong>112233</strong></p>' }),
  '112233',
  'html-only email'
);

assert.equal(
  extractVerificationCode({
    text: 'Visit https://x.example.com/account_verifications?verification=04312798-1fd6-4724-94a8-e19e3f21735b&via_launch_code_email=true to continue. Your code: 246810'
  }),
  '246810',
  'must ignore UUID/token fragments and identifiers, pick the keyword-adjacent code'
);

assert.equal(
  extractVerificationCode({ text: 'Hello, no codes here at all.' }),
  '',
  'no code present'
);

console.log('email-code-extraction: all assertions passed');
