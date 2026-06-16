export interface AppConfiguration {
  port: number;
  corsOrigins: string;
  logRequests: boolean;
  jwt: {
    secret: string;
    accessTtl: number; // seconds
    refreshTtlDays: number;
  };
  otp: {
    ttl: number; // seconds
    exposeDevCode: boolean;
  };
  firebase: {
    // Path to the Firebase service-account JSON. Unset = Firebase login disabled.
    credentialsFile?: string;
  };
  defaultShopId: string;
}

export default (): AppConfiguration => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  corsOrigins: process.env.CORS_ORIGINS ?? '*',
  logRequests: (process.env.LOG_REQUESTS ?? 'false') === 'true',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-pitstop-change-me',
    accessTtl: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
    refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '30', 10),
  },
  otp: {
    ttl: parseInt(process.env.OTP_TTL ?? '300', 10),
    exposeDevCode: (process.env.OTP_EXPOSE_DEV_CODE ?? 'true') === 'true',
  },
  firebase: {
    credentialsFile: process.env.FIREBASE_CREDENTIALS_FILE,
  },
  defaultShopId: process.env.DEFAULT_SHOP_ID ?? 'shop_pitstop_hsr',
});
