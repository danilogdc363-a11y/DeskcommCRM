"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { funisDoMenu } from "@/app/actions/shell/funisDoMenu";
import { cn } from "@/lib/utils";

/**
 * Um atalho por funil, recuado abaixo de "Funis": um clique abre o quadro
 * (`/app/pipelines/<id>`) sem passar pela lista. Some com o menu recolhido —
 * sem rótulo, um atalho vira só um ponto.
 */
export function AtalhosDosFunis({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data } = useQuery({
    queryKey: ["sidebar", "funis"],
    queryFn: () => funisDoMenu(),
    staleTime: 60_000,
  });
  if (!data?.length) return null;
  return (
    <ul className="space-y-0.5" data-testid="atalhos-dos-funis">
      {data.map((funil) => {
        const href = `/app/pipelines/${funil.id}`;
        const ativo = pathname === href || pathname.startsWith(href + "/");
        return (
          <li key={funil.id}>
            <Link
              href={href}
              aria-current={ativo ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2 rounded-md py-1 pr-3 pl-10 text-sm transition-colors",
                ativo
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
              <span className="truncate">{funil.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
