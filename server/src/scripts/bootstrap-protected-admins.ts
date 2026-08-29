import crypto from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { hashPassword } from '../auth/password.js';
import { validateProtectedAdminPasswords } from '../protected-admin-bootstrap.js';
import { prisma } from '../prisma.js';
import { seedAuthorizationCatalog } from '../rbac-seed.js';

const administrators = [
  { nickname: '蛋总-敦敦', key: 'fixed-administrator-1' },
  { nickname: '蛋总-千焦', key: 'fixed-administrator-2' },
] as const;
const categories = ['study', 'job', 'side', 'hobby', 'game', 'life'] as const;

function readHidden(prompt: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new Error('INTERACTIVE_TTY_REQUIRED');
  output.write(`${prompt}（输入已隐藏）: `);
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          finish();
          reject(new Error('CANCELLED'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else value += character;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function main() {
  const readline = createInterface({ input, output });
  const firstUserIdText = (await readline.question('请输入需要原地重命名的现有管理员用户 ID: ')).trim();
  readline.close();
  if (!/^\d+$/.test(firstUserIdText)) throw new Error('INVALID_USER_ID');
  const firstUserId = BigInt(firstUserIdText);

  const first = await readHidden('请输入第一个固定管理员临时密码');
  const firstConfirmation = await readHidden('再次输入第一个固定管理员临时密码');
  const second = await readHidden('请输入第二个固定管理员临时密码');
  const secondConfirmation = await readHidden('再次输入第二个固定管理员临时密码');
  validateProtectedAdminPasswords({ first, firstConfirmation, second, secondConfirmation });

  const [firstHash, secondHash, existingFirst, firstNameOwner, secondNameOwner, existingSecond] = await Promise.all([
    hashPassword(first),
    hashPassword(second),
    prisma.user.findUnique({ where: { id: firstUserId }, select: { id: true } }),
    prisma.user.findUnique({ where: { nickname: administrators[0].nickname }, select: { id: true } }),
    prisma.user.findUnique({ where: { nickname: administrators[1].nickname }, select: { id: true, protectedAdminKey: true } }),
    prisma.user.findUnique({ where: { protectedAdminKey: administrators[1].key }, select: { id: true } }),
  ]);
  if (!existingFirst) throw new Error('EXISTING_ADMIN_NOT_FOUND');
  if (firstNameOwner && firstNameOwner.id !== firstUserId) throw new Error('FIRST_ADMIN_NAME_CONFLICT');
  if (existingSecond && secondNameOwner && existingSecond.id !== secondNameOwner.id) throw new Error('SECOND_ADMIN_NAME_CONFLICT');
  if (!existingSecond && secondNameOwner && secondNameOwner.protectedAdminKey !== administrators[1].key) throw new Error('SECOND_ADMIN_NAME_CONFLICT');
  const secondUser = existingSecond ?? (secondNameOwner?.protectedAdminKey === administrators[1].key ? secondNameOwner : null);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: firstUserId },
      data: { nickname: administrators[0].nickname, passwordHash: firstHash, protectedAdminKey: administrators[0].key, mustChangePassword: true, status: 'active', role: 'admin' },
    });
    await tx.authSession.updateMany({ where: { userId: firstUserId, revokedAt: null }, data: { revokedAt: new Date() } });

    const secondData = { nickname: administrators[1].nickname, passwordHash: secondHash, protectedAdminKey: administrators[1].key, mustChangePassword: true, status: 'active' as const, role: 'admin' as const };
    const savedSecond = secondUser
      ? await tx.user.update({ where: { id: secondUser.id }, data: secondData })
      : await tx.user.create({
          data: {
            ...secondData,
            inviteCode: crypto.randomBytes(5).toString('hex').toUpperCase(),
            stats: { create: {} },
            account: { create: {} },
            characters: { create: categories.map((category) => ({ category, unlocked: category === 'study', isCurrent: category === 'study', unlockedAt: category === 'study' ? new Date() : null })) },
          },
        });
    await tx.authSession.updateMany({ where: { userId: savedSecond.id, revokedAt: null }, data: { revokedAt: new Date() } });
  });

  await seedAuthorizationCatalog(prisma);
  output.write('固定管理员初始化完成。两个账号首次登录都必须修改临时密码。\n');
}

main()
  .catch((error) => {
    const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    output.write(`初始化失败：${code}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
