import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/nunito";
import "./globals.css";

export const metadata: Metadata = {
  title: "LingoFlix",
  description: "Understand every line on Netflix.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
