import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          // repo: 레포 생성/커밋(컨텐츠 쓰기)용
          scope: "read:user user:email repo",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.access_token) token.githubAccessToken = account.access_token;
      const p = profile as { login?: string } | undefined;
      if (p?.login) token.githubLogin = p.login;
      return token;
    },
    async session({ session, token }) {
      session.githubAccessToken =
        typeof token.githubAccessToken === "string"
          ? token.githubAccessToken
          : undefined;
      session.githubLogin =
        typeof token.githubLogin === "string" ? token.githubLogin : undefined;
      return session;
    },
  },
};

