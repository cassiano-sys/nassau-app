// ── Image resize helper ──────────────────────────────────────────────────────
// Phone camera photos routinely come in at 3-12MB (often more once base64
// inflates them ~33%). Sending that straight to a serverless function, on top
// of the vision model's own processing time, is a common cause of function
// timeouts and oversized-request failures - which look to the user like "a
// leitura falhou" with zero explanation. Downscaling to a size that's still
// comfortably legible for OCR (long side maxDim, JPEG quality) cuts payload by
// 80-95% with no real loss of read accuracy for printed/handwritten digits.
export function resizeImageToBase64(file, maxDim = 1800, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo de imagem'))
    reader.onload = (ev) => {
      const img = new Image()
      img.onerror = () => reject(new Error('Não foi possível decodificar a imagem'))
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        resolve({ dataUrl, base64: dataUrl.split(',')[1] })
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  })
}
