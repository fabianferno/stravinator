import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "quiet" | "neutral";

function classes(variant: ButtonVariant, small: boolean, extra?: string) {
  return ["btn", `btn-${variant}`, small ? "btn-sm" : "", extra ?? ""].filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  children: ReactNode;
}

/** A real <button>. Use for in-page actions. */
export function Button({
  variant = "neutral",
  small = false,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={classes(variant, small, className)} {...rest}>
      {children}
    </button>
  );
}

export interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  small?: boolean;
  className?: string;
  /** Set for downloads / external destinations, which use a plain anchor. */
  external?: boolean;
  download?: string;
  children: ReactNode;
}

/** A real <a>. Use for navigation. */
export function ButtonLink({
  href,
  variant = "neutral",
  small = false,
  className,
  external = false,
  download,
  children,
}: ButtonLinkProps) {
  const cls = classes(variant, small, className);
  if (external || download !== undefined) {
    return (
      <a
        className={cls}
        href={href}
        download={download}
        rel={external ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  }
  return (
    <Link className={cls} href={href}>
      {children}
    </Link>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="btn-row">{children}</div>;
}
