"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { urlDoNovoCliente } from "@/lib/acelera/novo-cliente-url";

/** ACELERA (fork): monta o link para o OS; `null` = variável ausente, sem botão. */
export function useNovoClienteUrl(): (leadId: string) => string | null {
  const { data } = useQuery({
    queryKey: ["acelera", "novo-cliente"],
    queryFn: () => apiClient.get<{ data: { base: string | null } }>("/api/v1/acelera/novo-cliente"),
    staleTime: Infinity,
    retry: false,
  });
  return (leadId) => urlDoNovoCliente(data?.data?.base, leadId);
}
