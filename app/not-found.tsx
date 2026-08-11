import Link from "next/link";

export default function NotFound() {
  return <section className="empty-page"><p className="eyebrow"><span /> 404</p><h1>This page wandered off.</h1><Link className="button button-dark" href="/">Return home</Link></section>;
}
