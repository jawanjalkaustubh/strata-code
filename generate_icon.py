import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

base_dir = r"d:\AntiGravity\local-code-studio"
assets_dir = os.path.join(base_dir, "assets")
os.makedirs(assets_dir, exist_ok=True)

# 1024x1024 canvas for supersampling
W, H = 1024, 1024
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))

# 1. Create rounded rectangle mask with smooth corners
mask = Image.new("L", (W, H), 0)
draw_mask = ImageDraw.Draw(mask)
padding = 48
radius = 220
draw_mask.rounded_rectangle(
    [padding, padding, W - padding, H - padding],
    radius=radius,
    fill=255
)

# 2. Generate smooth 3-stop diagonal gradient
# Colors: Indigo (99, 102, 241) -> Purple (168, 85, 247) -> Pink (236, 72, 153)
c1 = (99, 102, 241)
c2 = (168, 85, 247)
c3 = (236, 72, 153)

gradient = Image.new("RGBA", (W, H), (0, 0, 0, 0))
pixels = gradient.load()

for y in range(H):
    for x in range(W):
        # Diagonal factor 0 to 1
        t = (x * 0.9 + y * 1.1) / (W * 0.9 + H * 1.1)
        t = max(0.0, min(1.0, t))
        if t < 0.5:
            # Interpolate c1 to c2
            f = t * 2.0
            r = int(c1[0] + (c2[0] - c1[0]) * f)
            g = int(c1[1] + (c2[1] - c1[1]) * f)
            b = int(c1[2] + (c2[2] - c1[2]) * f)
        else:
            # Interpolate c2 to c3
            f = (t - 0.5) * 2.0
            r = int(c2[0] + (c3[0] - c2[0]) * f)
            g = int(c2[1] + (c3[1] - c2[1]) * f)
            b = int(c2[2] + (c3[2] - c2[2]) * f)
        pixels[x, y] = (r, g, b, 255)

# Apply mask to gradient
gradient.putalpha(mask)

# 3. Add subtle top-inner specular lighting highlight
highlight = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw_hl = ImageDraw.Draw(highlight)
draw_hl.rounded_rectangle(
    [padding + 4, padding + 4, W - padding - 4, H - padding - 4],
    radius=radius - 4,
    outline=(255, 255, 255, 60),
    width=6
)
gradient = Image.alpha_composite(gradient, highlight)

# 4. Render clean, modern bold "A" letter with soft drop shadow
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw_shadow = ImageDraw.Draw(shadow)

font_path = r"C:\Windows\Fonts\segoeuib.ttf"
font_size = 560
font = ImageFont.truetype(font_path, font_size)

# Measure text position
text = "A"
bbox = font.getbbox(text)
text_w = bbox[2] - bbox[0]
text_h = bbox[3] - bbox[1]

# Center the text
text_x = (W - text_w) // 2 - bbox[0]
text_y = (H - text_h) // 2 - bbox[1] - 20

# Draw subtle shadow for depth
draw_shadow.text((text_x, text_y + 12), text, font=font, fill=(30, 10, 60, 90))
shadow = shadow.filter(ImageFilter.GaussianBlur(16))
gradient = Image.alpha_composite(gradient, shadow)

# Draw crisp white "A"
draw_text = ImageDraw.Draw(gradient)
draw_text.text((text_x, text_y), text, font=font, fill=(255, 255, 255, 255))

# 5. Downscale with Lanczos filter to 256x256 for super-sampling antialiasing
icon_256 = gradient.resize((256, 256), Image.Resampling.LANCZOS)
icon_512 = gradient.resize((512, 512), Image.Resampling.LANCZOS)

# Save PNGs
png_path = os.path.join(assets_dir, "apex-code.png")
icon_512.save(png_path, "PNG")
print(f"Saved PNG: {png_path}")

# Save Multi-resolution ICO
ico_path = os.path.join(assets_dir, "apex-code.ico")
icon_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
icon_256.save(ico_path, format="ICO", sizes=icon_sizes)
print(f"Saved ICO: {ico_path}")

# Also copy to backup directory
backup_assets = r"C:\AI_dev\projects\apex_studio\assets"
os.makedirs(backup_assets, exist_ok=True)
icon_512.save(os.path.join(backup_assets, "apex-code.png"), "PNG")
icon_256.save(os.path.join(backup_assets, "apex-code.ico"), format="ICO", sizes=icon_sizes)
print("Copied to backup assets folder.")
