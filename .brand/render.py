from PIL import Image, ImageDraw

INK = (15, 20, 28, 255)
PAPER = (244, 241, 234, 255)
PAPER_BORDER = (244, 241, 234, 31)  # 12% opacity
INDIGO = (79, 70, 229, 255)
TEAL = (13, 148, 136, 255)
AMBER = (217, 119, 6, 255)
CLEAR = (0, 0, 0, 0)

def new_canvas():
    return Image.new("RGBA", (1024, 1024), CLEAR)

def draw_tile(d):
    d.rounded_rectangle((32, 32, 992, 992), radius=211, fill=INK)
    d.rounded_rectangle((52, 52, 972, 972), radius=192, outline=PAPER_BORDER, width=4)

def ring_layer(cx, cy, r_out, r_in, start, end, color):
    """Ring band on its own transparent layer; safe to composite over anything."""
    layer = Image.new("RGBA", (1024, 1024), CLEAR)
    ld = ImageDraw.Draw(layer)
    bbox_out = (cx - r_out, cy - r_out, cx + r_out, cy + r_out)
    ld.pieslice(bbox_out, start, end, fill=color)
    bbox_in = (cx - r_in, cy - r_in, cx + r_in, cy + r_in)
    ld.pieslice(bbox_in, start, end, fill=CLEAR)
    return layer

def emidost_mark():
    im = new_canvas(); d = ImageDraw.Draw(im)
    draw_tile(d)
    # open padlock body (paper = free/released)
    d.rounded_rectangle((312, 512, 712, 856), radius=64, fill=PAPER)
    # keyhole stays ink (the financing channel)
    d.ellipse((452, 532, 572, 652), fill=INK)
    d.rounded_rectangle((482, 630, 542, 760), radius=30, fill=INK)
    # shackle: indigo left arm (owner), teal top arc (retailer), amber right arm (customer, open)
    d.rounded_rectangle((310, 348, 402, 512), radius=46, fill=INDIGO)
    arc = ring_layer(512, 348, 156, 64, 180, 360, TEAL)
    ad = ImageDraw.Draw(arc)
    ad.ellipse((310, 302, 402, 394), fill=TEAL)
    ad.ellipse((622, 302, 714, 394), fill=TEAL)
    im.alpha_composite(arc)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((622, 348, 714, 448), radius=46, fill=AMBER)
    return im

def wifi_mark():
    im = new_canvas(); d = ImageDraw.Draw(im)
    draw_tile(d)
    outer = ring_layer(512, 384, 390, 306, 180, 360, AMBER)
    od = ImageDraw.Draw(outer)
    od.ellipse((194, 342, 278, 426), fill=AMBER)
    od.ellipse((746, 342, 830, 426), fill=AMBER)
    im.alpha_composite(outer)
    middle = ring_layer(512, 469, 270, 198, 180, 360, TEAL)
    md = ImageDraw.Draw(middle)
    md.ellipse((285, 433, 357, 505), fill=TEAL)
    md.ellipse((667, 433, 739, 505), fill=TEAL)
    im.alpha_composite(middle)
    inner = ring_layer(512, 554, 150, 90, 180, 360, AMBER)
    idr = ImageDraw.Draw(inner)
    idr.ellipse((376, 524, 436, 584), fill=AMBER)
    idr.ellipse((588, 524, 648, 584), fill=AMBER)
    im.alpha_composite(inner)
    d = ImageDraw.Draw(im)
    d.ellipse((436, 584, 588, 736), fill=AMBER)
    return im

def scaled(base, scale):
    out = new_canvas()
    size = int(1024 * scale)
    m = base.resize((size, size), Image.LANCZOS)
    out.paste(m, ((1024 - size) // 2, (1024 - size) // 2), m)
    return out

def save_all(name, base):
    base.save(f"D:/emidost/.brand/{name}.png")
    scaled(base, 0.62).save(f"D:/emidost/.brand/{name}-adaptive.png")
    scaled(base, 0.40).save(f"D:/emidost/.brand/{name}-splash.png")

save_all("emidost-mark", emidost_mark())
save_all("wifi-mark", wifi_mark())
print("rendered all PNGs (layer-composited rings)")
