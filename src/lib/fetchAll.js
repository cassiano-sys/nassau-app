// O Supabase devolve no máximo 1.000 linhas por consulta (limite padrão da
// API). Para somas que precisam de TODAS as linhas — ranking, H2H, saldo
// geral — busca em páginas de 1.000 até acabar. build() deve devolver uma
// consulta nova a cada chamada, com ordem estável (ex.: .order('id')).
export async function fetchAll(build, page = 1000) {
  let out = []
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1)
    if (error) return { data: out.length ? out : null, error }
    out = out.concat(data || [])
    if (!data || data.length < page) return { data: out, error: null }
  }
}
