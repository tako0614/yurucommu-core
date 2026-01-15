/**
 * Extract dominant colors from an image for palette suggestions
 */

/**
 * Extract dominant colors from an image URL
 * Uses canvas to sample pixels and quantize colors
 */
export async function extractDominantColors(imageUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve([]);
          return;
        }

        // Sample at smaller size for performance
        const size = 50;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(img, 0, 0, size, size);

        const imageData = ctx.getImageData(0, 0, size, size).data;
        const colorCounts: Record<string, number> = {};

        // Quantize pixels and count colors
        for (let i = 0; i < imageData.length; i += 4) {
          // Skip transparent pixels
          if (imageData[i + 3] < 128) continue;

          // Quantize to 32-step (8 levels per channel)
          const r = Math.round(imageData[i] / 32) * 32;
          const g = Math.round(imageData[i + 1] / 32) * 32;
          const b = Math.round(imageData[i + 2] / 32) * 32;

          const key = `rgb(${r},${g},${b})`;
          colorCounts[key] = (colorCounts[key] || 0) + 1;
        }

        // Sort by frequency and get top 5
        const sorted = Object.entries(colorCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([color]) => color);

        resolve(sorted);
      } catch (e) {
        console.error('Color extraction failed:', e);
        resolve([]);
      }
    };

    img.onerror = () => {
      resolve([]);
    };

    img.src = imageUrl;
  });
}

/**
 * Convert RGB string to hex
 */
export function rgbToHex(rgb: string): string {
  const match = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!match) return rgb;

  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);

  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Get contrasting text color (black or white) for a background
 */
export function getContrastColor(bgColor: string): string {
  // Parse RGB
  const match = bgColor.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!match) return '#ffffff';

  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5 ? '#000000' : '#ffffff';
}
