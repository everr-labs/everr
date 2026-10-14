export const withIdentityRequest = <T>(run: () => Promise<T>): Promise<T> =>
  run();
