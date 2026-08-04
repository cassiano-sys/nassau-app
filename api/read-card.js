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
      'Voce e um especialista em leitura de cartoees de golfe. Analise esta imagem.',
      '',
      'JOGADORES (na ordem em que aparecem no cartao):',
      playerList,
      '',
      'PAR de cada buraco: ' + (parStr || 'nao informado'),
      'INDICE STROKE dos buracos: ' + siStr,
      '',
      'REGRAS DE LEITURA - siga rigorosamente:',
      '1. Leia APENAS os scores brutos (gross) por buraco - numeros entre 1 e 12',
      '2. IGNORE: colunas de somatorio, totais de volta, handicap, net, diferencas (+/-), press',
      '3. Somatórios sao faceis de identificar: sao numeros altos (30-50 para 9 buracos) em colunas destacadas',
      '4. Para buracos com caligrafia duvidosa, use o par do buraco como referencia:',
      '   - Em um Par 3: score provavel entre 2 e 6 (nunca 8 ou 9)',
      '   - Em um Par 4: score provavel entre 3 e 7',
      '   - Em um Par 5: score provavel entre 4 e 8',
      '   - Se um numero parece ser 3 ou 8 em um Par 3, escolha 3',
      '   - Se um numero parece ser 4 ou 9 em um Par 4, escolha 4 ou 5',
      '5. Use o handicap do jogador como referencia adicional:',
      '   - Jogador HCP 0-9: scores tipicamente proximo ao par',
      '   - Jogador HCP 10-18: scores tipicamente par+1 ou par+2',
      '   - Jogador HCP 19+: scores tipicamente par+2 ou par+3',
      '6. Nunca deixe de retornar um resultado - sempre retorne sua melhor estimativa',
      '7. Buraco realmente ilegivel (impossivel estimar): use null',
      '8. Nunca copie score de buraco adjacente para preencher vazio',
      '9. Cada buraco e lido de forma completamente independente',
      '',
      'IMPORTANTE: mesmo que a imagem seja parcialmente borrada ou inclinada,',
      'faca o melhor esforco possivel e retorne um resultado. Nunca retorne erro.',
      '',
      'Retorne APENAS este JSON:',
      '{',
      '  "scores": [',
      '    [s1,s2,s3,s4,s5,s6,s7,s8,s9,s10,s11,s12,s13,s14,s15,s16,s17,s18],',
      '    ... um array de 18 valores por jogador ...',
      '  ],',
      '  "confidence": "high" ou "medium" ou "low",',
      '  "notes": "observacoes sobre leitura"',
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
    // Return a graceful fallback instead of error
    const { players } = await req.json().catch(() => ({ players: [] }))
    const fallback = {
      scores: players.map(() => Array(18).fill(null)),
      confidence: 'low',
      notes: 'Nao foi possivel ler o cartao automaticamente. Por favor, lance os scores manualmente.'
    }
    return new Response(JSON.stringify(fallback), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}
