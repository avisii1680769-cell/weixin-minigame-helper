// 最小可运行微信小游戏示例 —— 用于验证预览链路
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

let x = 0;
let y = canvas.height / 2;

function loop() {
  x = (x + 3) % canvas.width;
  y = canvas.height / 2 + Math.sin(Date.now() / 400) * 80;

  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#4ade80';
  ctx.fillRect(x, y, 48, 48);

  ctx.fillStyle = '#ffffff';
  ctx.font = '20px sans-serif';
  ctx.fillText('WeChat Mini Game · OK', 24, 60);

  console.log('frame x=' + Math.round(x));
  requestAnimationFrame(loop);
}

loop();
