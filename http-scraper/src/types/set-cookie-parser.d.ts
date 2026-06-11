declare module "set-cookie-parser" {
  type ParsedCookie = {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: Date;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: string;
  };

  const setCookieParser: {
    parse(input: string | string[], options?: { map?: boolean }): ParsedCookie[];
  };

  export default setCookieParser;
}