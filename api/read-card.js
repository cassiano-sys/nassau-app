export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const { imageBase64, players, si, par } = await req.json()

    const playerList = players.map((p, i) => `${i + 1}. ${p.name} (HCP ${p.handicap})`).join('\n')
    const parStr = (par || []).map((p, i) => `B${i+1}=Par${p}`).join(', ')

    const prompt = [
      'Leia os scores brutos (gross) deste cartao de golfe.',
      '',
      'JOGADORES na ordem em que aparecem:',
      playerList,
      '',
      'PAR de cada buraco: ' + (parStr || 'nao informado'),
      '',
      'REGRAS:',
      '1. Scores validos por buraco: numeros entre 1 e 12',
      '2. IGNORE: somatórios (numeros >15), sinais +/-, letras isoladas (iniciais de jogadores), colunas HD e NET',
      '3. Cartoes brasileiros tem coluna com INICIAL DO JOGADOR antes do Back 9 - ignore essa letra, nao e um score',
      '4. Para numero duvidoso, use o par: Par3->score entre 2-6, Par4->entre 3-7, Par5->entre 4-8',
      '5. Buraco em branco ou nao jogado: use null. NAO copie score do buraco anterior',
      '6. Se foto cortada, retorne os buracos visiveis e null para os demais',
      '',
      'Retorne APENAS JSON:',
      '{',
      '  "scores": [[s1..s18], [s1..s18], ...],',
      '  "confidence": "high"|"medium"|"low",',
      '  "card_complete": true|false,',
      '  "notes": "observacoes"',
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
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (e) {
    return new Response(JSON.stringify({
      scores: [],
      confidence: 'low',
      card_complete: false,
      notes: 'Erro ao processar. Verifique se o cartao esta completamente visivel.'
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}
