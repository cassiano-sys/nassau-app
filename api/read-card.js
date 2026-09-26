import https from 'https'
 export const config = { maxDuration: 60 }

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
      'PASSO 1 - MAPEIE A ESTRUTURA DO CARTAO (o layout varia entre campos, nao assuma um padrao fixo):',
      '- Identifique as 9 colunas de score dos buracos 1-9 e, logo em seguida, a coluna de total da primeira volta (pode se chamar "1V", "OUT", "TOT", etc).',
      '- Identifique as 9 colunas de score dos buracos 10-18 e, logo em seguida, a coluna de total da segunda volta (pode se chamar "2V", "IN", "TOT", etc) e/ou total geral.',
      '- Note tambem colunas que NAO sao score (HD, NET, iniciais do jogador, indice de handicap por buraco, distancia por tee) para nao confundi-las com scores.',
      '',
      'PASSO 2 - CUIDADO COM O ERRO MAIS COMUM:',
      'A coluna de total de cada volta costuma ser um numero de 2 digitos (10 a 18+) escrito logo a direita do ultimo buraco daquela volta (buraco 9 ou buraco 18). E facil confundir visualmente o PRIMEIRO DIGITO desse total com o score do ultimo buraco da volta. Se o valor que voce esta prestes a atribuir ao buraco 9 ou ao buraco 18 for maior que 9, voce quase certamente esta lendo o total por engano - o score real esta na coluna anterior a essa.',
      '',
      'PASSO 3 - CONFIRA SEU PROPRIO TRABALHO (SEM SE ENGANAR PELO CONTRARIO):',
      'Depois de ler os 9 valores de uma volta de um jogador, some-os e compare com o total impresso/escrito ao lado, SE existir e for legivel - se nao houver total escrito, pule este passo e confie no seu mapeamento (passo 1) e na regra do passo 2.',
      'Se a soma bater, otimo, isso confirma sua leitura.',
      'Se a soma NAO bater, existem duas explicacoes possiveis: (a) voce leu algum digito errado (o mais comum e no buraco 9/18, mas pode ser qualquer buraco pouco legivel), ou (b) o proprio jogador errou a conta ao somar de cabeca durante a rodada - isso e comum e o total escrito por humano NAO e uma verdade absoluta.',
      'Portanto: releia com atencao os buracos daquela volta que estavam mais ambiguos, comecando pelo 9/18. So mude um score se, ao olhar de novo, um outro digito for visualmente tao ou mais provavel que o que voce tinha lido. NUNCA troque um digito que voce consegue ler com clareza apenas para forcar a bater com o total - mantenha sua leitura original nesse caso. Em qualquer um dos dois casos (soma bateu ou nao foi possivel resolver a diferenca), registre no campo "notes" quando a soma de uma volta nao bateu com o total escrito (ex: "soma da volta 2 do jogador X nao bate com o total do cartao - possivel erro de soma do proprio jogador, conferir manualmente") e use confidence "medium" ou "low" para essa parte.',
      '',
      'REGRAS GERAIS:',
      '1. Scores validos por buraco: numeros entre 1 e 12',
      '2. NAO copie numeros de colunas de total, HD, NET, indice de handicap ou distancia para dentro dos scores',
      '3. Cartoes brasileiros as vezes tem coluna com INICIAL DO JOGADOR antes do Back 9 - ignore essa letra',
      '4. Para numero duvidoso use o par como referencia: Par3->2-6, Par4->3-7, Par5->4-8',
      '5. Buraco em branco: use null. NAO copie score do buraco anterior',
      '',
      'FORMATO DA RESPOSTA:',
      'Primeiro escreva, em poucas linhas, seu mapeamento de colunas (passo 1) e a conferencia de somas (passo 3) - isso te ajuda a nao errar.',
      'Depois, escreva exatamente a palavra "JSON_FINAL:" e, na sequencia, APENAS o JSON puro (sem markdown, sem texto depois):',
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
      max_tokens: 3500,
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
            // O modelo escreve seu raciocínio (mapeamento de colunas + conferência de somas)
            // antes do JSON final, marcado por "JSON_FINAL:". Pegamos só o que vem depois.
            const marker = 'JSON_FINAL:'
            const markerIdx = text.lastIndexOf(marker)
            const jsonPart = markerIdx >= 0 ? text.slice(markerIdx + marker.length) : text
            const withoutFences = jsonPart.replace(/```json|```/g, '').trim()
            // Pega só o bloco {...} caso sobre algum texto antes/depois
            const jsonMatch = withoutFences.match(/\{[\s\S]*\}/)
            const clean = jsonMatch ? jsonMatch[0] : withoutFences
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
