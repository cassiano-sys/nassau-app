export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const { imageBase64, players, si, par } = await req.json()

    const playerList = players.map((p, i) => `${i + 1}. ${p.name} (HCP ${p.handicap})`).join('\n')
    const siStr = si.map((s, i) => `B${i+1}=SI${s}`).join(', ')
    const parStr = (par || []).map((p, i) => `B${i+1}=Par${p}`).join(', ')

    const prompt = [
      'Voce e um especialista em leitura de cartoees de golfe brasileiro. Analise esta imagem com muito cuidado.',
      '',
      'JOGADORES esperados (na ordem em que aparecem no cartao):',
      playerList,
      '',
      'PAR de cada buraco: ' + (parStr || 'nao informado'),
      'INDICE STROKE: ' + siStr,
      '',
      '=== VERIFICACAO INICIAL ===',
      'Antes de ler os scores, verifique:',
      'A) O cartao esta completo? Sao visiveis todos os 18 buracos (ou pelo menos os jogados)?',
      '   Se a foto esta cortada e faltam buracos, indique em "notes" quais buracos nao estao visiveis.',
      'B) O cartao e dobrado ao meio? Muitos cartoees brasileiros mostram Front 9 na face esquerda e Back 9 na face direita.',
      '',
      '=== ESTRUTURA DO CARTAO BRASILEIRO ===',
      'Cartoees brasileiros frequentemente tem:',
      '- Uma coluna com a INICIAL DO JOGADOR antes dos scores do Back 9 (ex: "C" para Cassiano, "M" para Moro)',
      '- Essa coluna de inicial NAO E UM SCORE - deve ser completamente ignorada',
      '- Colunas de SOMATORIO apos o buraco 9 e apos o buraco 18 (numeros altos: 35-50 para F9, 60-100 para total)',
      '- Uma linha abaixo dos scores com DIFERENCAS DE HANDICAP (numeros com +/- ou pequenos 0,1,2)',
      '- Colunas HD e NET no final - ignorar',
      '',
      '=== REGRAS DE LEITURA ===',
      '1. Leia APENAS os 18 scores brutos (gross) por jogador, um por buraco',
      '2. Scores validos por buraco: entre 1 e 12',
      '3. Se encontrar uma LETRA (A, B, C, M, K, etc) entre colunas numericas: IGNORE - e inicial do jogador',
      '4. Se encontrar numero muito alto (>15): e somatorio - IGNORE',
      '5. Se encontrar numero com sinal (+/-): e diferenca de handicap - IGNORE',
      '6. Use o par do buraco como referencia para numeros duvidosos:',
      '   - Par 3: score esperado entre 2 e 6. Se duvida entre 3 e 8, escolha 3',
      '   - Par 4: score esperado entre 3 e 7. Se duvida entre 4 e 9, escolha 4 ou 5',
      '   - Par 5: score esperado entre 4 e 8. Se duvida entre 5 e 8, ambos sao possiveis',
      '7. Use o handicap do jogador como referencia:',
      '   - HCP 0-9: scores tipicamente par ou par+1',
      '   - HCP 10-18: scores tipicamente par+1 ou par+2',
      '   - HCP 19+: scores tipicamente par+2 ou par+3',
      '8. Buraco NAO JOGADO ou realmente ilegivel: use null',
      '9. NUNCA copie score de buraco adjacente para preencher vazio',
      '10. NUNCA desloque scores - se a coluna 10 esta vazia, B10=null e B11 continua sendo B11',
      '11. Sempre retorne um resultado, mesmo parcial - nunca retorne erro',
      '',
      '=== CONTAGEM CUIDADOSA ===',
      'Conte as colunas de score com cuidado:',
      '- Front 9: exatamente 9 colunas numericas (ignorando colunas de letra)',
      '- Back 9: exatamente 9 colunas numericas (ignorando coluna de inicial se existir)',
      '- Total: 18 valores por jogador',
      '',
      'Retorne APENAS este JSON:',
      '{',
      '  "scores": [',
      '    [s1,s2,s3,s4,s5,s6,s7,s8,s9,s10,s11,s12,s13,s14,s15,s16,s17,s18],',
      '    ... um array de 18 valores por jogador na ordem listada ...',
      '  ],',
      '  "confidence": "high" ou "medium" ou "low",',
      '  "card_complete": true ou false,',
      '  "missing_holes": "descricao de buracos nao visiveis se houver",',
      '  "notes": "observacoes sobre leitura, iniciais encontradas, etc"',
      '}'
    ].join('\n')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.VITE_ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const clean = text.replace(/```json|```/g, '').trim()
    const result = JSON.parse(clean)

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e) {
    return new Response(JSON.stringify({
      scores: [],
      confidence: 'low',
      card_complete: false,
      notes: 'Nao foi possivel processar a imagem. Verifique se o cartao esta completamente visivel na foto.'
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}
