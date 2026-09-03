import https from 'https'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).send('Method not allowed')

  try {
    let body = req.body
    if (!body || typeof body === 'string') {
      body = JSON.parse(body || '{}')
    }

    const { imageBase64, players, si, par, handwritingBase64 } = body

    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' })
    }

    const playerList = (players || []).map((p, i) => `${i + 1}. ${p.name} (HCP ${p.handicap})`).join('\n')
    const parStr = (par || []).map((p, i) => `B${i+1}=Par${p}`).join(', ')

    const prompt = [
      'Leia os scores brutos (gross) deste cartao de golfe.',
      handwritingBase64
        ? 'A primeira imagem é uma AMOSTRA DE CALIGRAFIA: os números de 0 a 9 escritos à mão por quem normalmente preenche os cartões deste grupo. Use-a como referência para calibrar a leitura de dígitos ambíguos na foto do cartão (a segunda imagem).'
        : '',
      '',
      'JOGADORES na ordem em que aparecem:',
      playerList,
      '',
      'PAR de cada buraco: ' + (parStr || 'nao informado'),
      '',
      'REGRAS:',
      '1. Scores validos por buraco: numeros entre 1 e 12',
      '2. IGNORE: somatórios (numeros >15), sinais +/-, letras isoladas (iniciais), colunas HD e NET',
      '3. Cartoes brasileiros tem coluna com INICIAL DO JOGADOR antes do Back 9 - ignore essa letra',
      '4. Para numero duvidoso use o par: Par3->2-6, Par4->3-7, Par5->4-8',
      '5. Buraco em branco: use null. NAO copie score do buraco anterior',
      '',
      'Retorne APENAS JSON:',
      '{"scores":[[s1..s18],...],"confidence":"high|medium|low","card_complete":true/false,"notes":"obs"}'
    ].filter(Boolean).join('\n')

    const content = []
    if (handwritingBase64) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: handwritingBase64 } })
    }
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } })
    content.push({ type: 'text', text: prompt })

    const requestBody = JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content }]
    })

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      }
      const r = https.request(options, (response) => {
        let data = ''
        response.on('data', chunk => data += chunk)
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) return reject(new Error(JSON.stringify(parsed.error)))
            const text = parsed.content?.[0]?.text || ''
            const clean = text.replace(/```json|```/g, '').trim()
            resolve(JSON.parse(clean))
          } catch(e) {
            reject(new Error('Parse error: ' + data.slice(0, 200)))
          }
        })
      })
      r.on('error', reject)
      r.write(requestBody)
      r.end()
    })

    return res.status(200).json(result)

  } catch (e) {
    console.error('read-card error:', e.message)
    return res.status(200).json({
      scores: [],
      confidence: 'low',
      card_complete: false,
      notes: 'Erro: ' + e.message.slice(0, 100)
    })
  }
}
