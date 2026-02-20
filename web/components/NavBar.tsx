"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";

export function NavBar() {
  const pathname = usePathname();
  const { state, dispatch } = useStore();

  const links = [
    { href: "/", label: "Upload" },
    { href: "/review", label: "Review" },
    { href: "/dashboard", label: "Dashboard" },
  ];

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <Link href="/" className="text-lg font-bold text-gray-900">
          ChatterMatter
        </Link>
        <nav className="flex gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                pathname === link.href
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-500">Author</label>
        <input
          type="text"
          value={state.authorName}
          onChange={(e) => dispatch({ type: "SET_AUTHOR", name: e.target.value })}
          placeholder="Your name"
          className="border border-gray-300 rounded-md px-2 py-1 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
    </header>
  );
}
