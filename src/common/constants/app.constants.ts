export const authConstants = {
  accessTokenSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
  refreshTokenSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
  accessTokenTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTokenTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  bcryptSaltOrRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 10),
};
