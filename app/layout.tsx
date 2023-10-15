import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Navbar from "@components/navbar";
import Notification from "@components/Notification";
import AuthSession from "./components/AuthSession";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ecommerce",
  description: "ecommerce- Demo application",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthSession>
      <html lang="en">
        <body className={inter.className}>
          {children}
          <Notification />
        </body>
      </html>
    </AuthSession>
  );
}
