export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const { imageBase64, players, si } = await req.json()

    const playerList = players.map((p, i) => `${i + 1}. ${p.name} (HCP ${p.handicap})`).join('\n')
    const siStr = si.map((s, i) => `B${i+1}=SI${s}`).join(', ')

    const prompt = [
      'Voce e um especialista em leitura de cartoees de golfe. Analise esta imagem com cuidado.',
      '',
      'JOGADORES (na ordem em que aparecem no cartao):',
      playerList,
      '',
      'INDICE STROKE dos buracos: ' + siStr,
      '',
      'INSTRUCOES IMPORTANTES:',
      '1. O cartao tem 18 buracos: Front 9 (B1-B9) e Back 9 (B10-B18)',
      '2. Cada jogador tem UMA linha de scores - sao os numeros BRUTOS (gross) por buraco',
      '3. IGNORE totalmente: colunas de somatorio (aparecem apos B9 e apos B18), totais de volta, handicap, net, diferencas acumuladas, numeros de press',
      '4. Somatorios sao numeros ALTOS tipicamente entre 30-50 para 9 buracos ou 60-100 para 18 - IGNORE',
      '5. Scores validos por buraco estao tipicamente entre 2 e 12',
      '6. Numeros com sinais (+ ou -) sao diferencas - IGNORE',
      '7. Se um buraco estiver em branco, ilegivel ou sem score, use OBRIGATORIAMENTE null',
      '8. NUNCA repita o score de um buraco anterior para preencher um buraco em branco',
      '9. NUNCA interpole ou estime valores - null e a unica opcao para buracos sem score claro',
      '10. Cada score deve ser lido INDEPENDENTEMENTE - um buraco nao influencia o outro',
      '',
      'Retorne APENAS este JSON, sem texto adicional:',
      '{',
      '  "scores": [',
      '    [s1,s2,s3,s4,s5,s6,s7,s8,s9,s10,s11,s12,s13,s14,s15,s16,s17,s18],',
      '    ... um array de 18 numeros por jogador ...',
      '  ],',
      '  "confidence": "high" ou "medium" ou "low",',
      '  "notes": "descreva dificuldades de leitura"',
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
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
