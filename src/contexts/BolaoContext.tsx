import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

type Bolao = { id: string; nome: string };

type BolaoContextValue = {
  boloes: Bolao[];
  bolaoAtivo: Bolao | null;
  setBolaoAtivo: (b: Bolao) => void;
  loading: boolean;
};

const BolaoContext = createContext<BolaoContextValue>({
  boloes: [],
  bolaoAtivo: null,
  setBolaoAtivo: () => {},
  loading: true,
});

const STORAGE_KEY = "bolao_ativo_id";

export function BolaoProvider({ children }: { children: ReactNode }) {
  const [boloes, setBoloes] = useState<Bolao[]>([]);
  const [bolaoAtivo, setBolaoAtivoState] = useState<Bolao | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user || !active) return;

      const { data: mb } = await supabase
        .from("membros_bolao")
        .select("bolao_id")
        .eq("usuario_id", u.user.id);

      const ids = (mb ?? []).map((m: { bolao_id: string }) => m.bolao_id);
      if (ids.length === 0) {
        setLoading(false);
        return;
      }

      const { data: bs } = await supabase
        .from("boloes")
        .select("id,nome")
        .in("id", ids)
        .order("criado_em", { ascending: false });

      if (!active) return;
      const lista = (bs ?? []) as Bolao[];
      setBoloes(lista);

      const savedId = localStorage.getItem(STORAGE_KEY);
      const salvo = savedId ? lista.find((b) => b.id === savedId) : null;
      setBolaoAtivoState(salvo ?? lista[0] ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  function setBolaoAtivo(b: Bolao) {
    setBolaoAtivoState(b);
    localStorage.setItem(STORAGE_KEY, b.id);
  }

  return (
    <BolaoContext.Provider value={{ boloes, bolaoAtivo, setBolaoAtivo, loading }}>
      {children}
    </BolaoContext.Provider>
  );
}

export function useBolao() {
  return useContext(BolaoContext);
}
