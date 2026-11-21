export async function sampleDemoPhotos(): Promise<File[]> {
  return Promise.all(['dining-room-a-wide', 'dining-room-a-counter', 'dish-ramen-bowl', 'exterior-storefront', 'menu-board', 'obstructed-room'].map(async (name, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not prepare the sample images.');
    const rect = (color: string, x: number, y: number, width: number, height: number) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, height);
    };
    const shape = (color: string, ...points: [number, number][]) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.fill();
    };
    const ellipse = (color: string, x: number, y: number, rx: number, ry: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    const room = () => {
      rect('#554238', 0, 0, 600, 400);
      rect('#967e5e', 109, 54, 380, 210);
      shape('#6e4930', [0, 400], [109, 264], [489, 264], [600, 400]);
      rect('#24323b', 160 + index * 55, 82, 220, 102);
      for (let i = 0; i < 4; i++) {
        const x = i * 142 + index * 32;
        rect('#3c2828', x + 21, 274, 10, 70);
        rect('#3c2828', x + 85, 274, 10, 70);
        shape('#c69054', [x, 278], [x + 20, 253], [x + 90, 253], [x + 116, 278]);
        ellipse('#eee3c2', x + 56, 268, 13, 5);
        rect('#463021', x + 24, 0, 2, 106);
        ellipse('#efc36f', x + 25, 110, 28, 12);
      }
    };

    if (index < 2 || index === 5) {
      room();
      if (index === 5) shape('#211f22', [390, 0], [600, 0], [600, 400], [251, 400]);
    } else if (index === 2) {
      rect('#936448', 0, 0, 600, 400);
      ellipse('#50312b', 310, 220, 185, 143);
      ellipse('#e9e2cc', 300, 193, 169, 139);
      ellipse('#ac6943', 300, 193, 147, 115);
      ellipse('#e2b569', 289, 203, 91, 66);
      for (let i = 0; i < 9; i++) ellipse(i % 2 ? '#7b5137' : '#bd8559', 235 + i * 13, 148 + i % 3 * 14, 28, 13);
      ellipse('#fff0cd', 345, 237, 50, 30);
      ellipse('#e5a249', 345, 235, 23, 17);
      for (let i = 0; i < 22; i++) ellipse('#455039', 277 + (i * 23 % 126), 149 + (i * 19 % 77), 6, 3);
    } else {
      rect(index === 3 ? '#7a6456' : '#4a3930', 0, 0, 600, 400);
      rect('#c29e69', 76, 53, 448, 285);
      rect('#252d31', 91, 68, 418, 255);
      if (index === 3) {
        rect('#6e8890', 112, 148, 213, 155);
        rect('#52646e', 350, 148, 137, 175);
        rect('#a35745', 78, 112, 444, 42);
      } else {
        for (let i = 0; i < 6; i++) {
          rect('#d9c19e', 138, 110 + i * 30, 130 + i % 3 * 20, 5);
          rect('#d9c19e', 404, 110 + i * 30, 52, 5);
        }
      }
    }
    const vignette = ctx.createRadialGradient(300, 185, 65, 300, 200, 360);
    vignette.addColorStop(0, '#15141d00');
    vignette.addColorStop(1, '#15141d91');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, 600, 400);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((image) => {
      if (image) resolve(image);
      else reject(new Error('Could not encode a sample image.'));
    }, 'image/png'));
    return new File([blob], `demo-${name}.png`, { type: 'image/png' });
  }));
}
