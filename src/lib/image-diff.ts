export interface ImageDiffResult {
  differentPixels: number;
  totalPixels: number;
  ratio: number;
  dimensionsMatch: boolean;
}

/** 在浏览器端比较两张 PNG 的像素差异，供离线视觉回归使用。 */
export async function compareImageBlobs(current: Blob, baseline: Blob, threshold = 8): Promise<ImageDiffResult> {
  const [currentImage, baselineImage] = await Promise.all([createImageBitmap(current), createImageBitmap(baseline)]);
  const width = Math.max(currentImage.width, baselineImage.width);
  const height = Math.max(currentImage.height, baselineImage.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前环境不支持图像比较');
  const currentCanvas = document.createElement('canvas');
  currentCanvas.width = width;
  currentCanvas.height = height;
  currentCanvas.getContext('2d')?.drawImage(currentImage, 0, 0);
  const baselineCanvas = document.createElement('canvas');
  baselineCanvas.width = width;
  baselineCanvas.height = height;
  baselineCanvas.getContext('2d')?.drawImage(baselineImage, 0, 0);
  const currentData = currentCanvas.getContext('2d')?.getImageData(0, 0, width, height).data;
  const baselineData = baselineCanvas.getContext('2d')?.getImageData(0, 0, width, height).data;
  if (!currentData || !baselineData) throw new Error('无法读取图像像素');
  let differentPixels = 0;
  for (let index = 0; index < currentData.length; index += 4) {
    if (Math.max(
      Math.abs(currentData[index] - baselineData[index]),
      Math.abs(currentData[index + 1] - baselineData[index + 1]),
      Math.abs(currentData[index + 2] - baselineData[index + 2]),
      Math.abs(currentData[index + 3] - baselineData[index + 3]),
    ) > threshold) differentPixels += 1;
  }
  currentImage.close();
  baselineImage.close();
  return {
    differentPixels,
    totalPixels: width * height,
    ratio: differentPixels / Math.max(1, width * height),
    dimensionsMatch: currentImage.width === baselineImage.width && currentImage.height === baselineImage.height,
  };
}
