declare module "@mozilla/readability" {
  export class Readability {
    constructor(document: unknown);

    parse():
      | {
          textContent?: string | null;
          title?: string | null;
        }
      | null;
  }
}

declare module "cheerio" {
  export function load(html: string): any;
}

declare module "jsdom" {
  export class JSDOM {
    constructor(
      html: string,
      options: {
        url: string;
      },
    );

    window: {
      document: unknown;
    };
  }
}
