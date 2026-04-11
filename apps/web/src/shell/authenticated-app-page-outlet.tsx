import type { HTMLAttributes, ReactNode } from "react";

interface AuthenticatedAppPageHeader {
  action?: ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
}

export interface AuthenticatedAppPageOutletProps
  extends HTMLAttributes<HTMLDivElement> {
  [dataAttribute: `data-${string}`]: string | undefined;
  bodyClassName?: string;
  children?: ReactNode;
  header?: AuthenticatedAppPageHeader;
}

function joinClassNames(
  ...classNames: Array<string | undefined>
): string | undefined {
  const resolvedClassNames = classNames.filter(
    (className) => typeof className === "string" && className.length > 0,
  );

  return resolvedClassNames.length > 0
    ? resolvedClassNames.join(" ")
    : undefined;
}

export function AuthenticatedAppPageOutlet({
  bodyClassName,
  children,
  className,
  header,
  ...restProps
}: AuthenticatedAppPageOutletProps) {
  return (
    <section
      data-layout="authenticated-app-outlet"
      className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col"
    >
      <div
        {...restProps}
        className={joinClassNames(
          "waka-page-stack text-stone-900",
          className,
        )}
      >
        {header === undefined ? null : (
          <header
            data-layout="authenticated-app-page-header"
            className="waka-page-header"
          >
            <div className="waka-page-header-copy space-y-4">
              {header.eyebrow === undefined ? null : (
                <p className="text-sm uppercase tracking-[0.3em] text-amber-700">
                  {header.eyebrow}
                </p>
              )}
              <h1 className="max-w-3xl break-words text-3xl font-semibold tracking-tight text-stone-950 min-[56rem]:text-4xl">
                {header.title}
              </h1>
              {header.description === undefined ? null : (
                <p className="max-w-3xl break-words text-base leading-7 text-stone-600 min-[56rem]:text-lg">
                  {header.description}
                </p>
              )}
            </div>

            {header.action === undefined ? null : (
              <div className="waka-page-header-action">
                {header.action}
              </div>
            )}
          </header>
        )}

        <div
          data-layout="authenticated-app-page-body"
          className={joinClassNames(
            "flex w-full min-w-0 max-w-full flex-col waka-primary-section-stack",
            bodyClassName,
          )}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
