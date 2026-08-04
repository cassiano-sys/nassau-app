export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const { imageBase64, players, si } = await req.json()

    const playerList = players.map((p, i) => `${i + 1}. ${p.name} (HCP ${p.handicap})`).join('\n')
    const siStr = si.map((s, i) => `B${i+1}=SI${s}`).join(', ')

    const prompt = `Este é um cartão de golfe. Os jogadores são:
${playerList}

O Índice Stroke (SI) dos buracos é: ${siStr}

Leia os scores BRUTOS (gross) de cada jogador em cada buraco.
Retorne APENAS JSON válido, sem texto adicional:
{
  "scores": [
    [score_b1, score_b2, ..., score_b18],
    ...
  ],
  "confidence": "high" | "medium" | "low",
  "notes": "observações sobre leitura difícil"
}

Use null para buracos ilegíveis ou não jogados. Retorne apenas o JSON.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.VITE_ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1000,
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
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
