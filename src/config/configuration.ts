export interface AppConfiguration {
  port: number;
  corsOrigins: string;
  jwt: {
    secret: string;
    accessTtl: number; // seconds
    refreshTtlDays: number;
  };
  otp: {
    ttl: number; // seconds
    exposeDevCode: boolean;
  };
  defaultShopId: string;
}

export default (): AppConfiguration => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  corsOrigins: process.env.CORS_ORIGINS ?? '*',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-pitstop-change-me',
    accessTtl: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
    refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '30', 10),
  },
  otp: {
    ttl: parseInt(process.env.OTP_TTL ?? '300', 10),
    exposeDevCode: (process.env.OTP_EXPOSE_DEV_CODE ?? 'true') === 'true',
  },
  defaultShopId: process.env.DEFAULT_SHOP_ID ?? 'shop_pitstop_hsr',
});
