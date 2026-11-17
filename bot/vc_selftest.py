"""VC awaaz chain ka Termux self-test — bina Discord VC join kiye.

Ek jaani-pehchani line ko awaaz banakar asli VC jaisi chain chalata hai:
opus encode -> decode -> mono/WAV -> keyless Google STT.
AI chat ka provider Pollinations hai; is test ko kisi Gemini key ki zaroorat nahi.

Chalao:  python vc_selftest.py
"""
import asyncio, os, struct, subprocess, sys, tempfile, wave
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DISCORD_BOT_TOKEN", "x")

LINE = "Nezuko tum kaisi ho, aaj mausam kaisa hai"

async def main():
    import bot as b
    print("=== VC SELF TEST ===")
    print("1) Voice STT: keyless Google SpeechRecognition")
    # 2) Ek jaani hui awaaz banao (edge-tts, ladki wali Hindi awaaz)
    tmp = tempfile.mkdtemp()
    mp3 = os.path.join(tmp, "line.mp3"); wav = os.path.join(tmp, "line.wav")
    import edge_tts
    await edge_tts.Communicate(LINE, voice="hi-IN-SwaraNeural").save(mp3)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", mp3, "-ar", "48000", "-ac", "2", wav], check=True)
    with wave.open(wav, "rb") as w:
        pcm_stereo = w.readframes(w.getnframes())
    print("2) Test awaaz bani: %.1f sec stereo PCM" % (len(pcm_stereo) / (48000 * 4)))
    # 3) Jaise Discord se aata hai: 20ms ke opus packet banao, fir bot wala decoder chalao
    import discord
    if not discord.opus.is_loaded():
        discord.opus.load_opus("libopus.so.0") if os.path.exists("/data/data/com.termux/files/usr/lib/libopus.so.0") else None
    enc = discord.opus.Encoder(); dec = discord.opus.Decoder()
    frame = 960 * 2 * 2  # 20ms, 48k, stereo, 16-bit
    decoded = bytearray()
    for i in range(0, len(pcm_stereo) - frame + 1, frame):
        chunk = pcm_stereo[i:i + frame]
        try: packet = enc.encode(chunk, 960)
        except Exception as e: print("   encode fail:", e); break
        out = dec.decode(packet, fec=False)
        if out: decoded.extend(out)
    print("3) Opus round-trip: %.1f sec PCM wapas mila" % (len(decoded) / (48000 * 4)))
    if not decoded:
        print("RESULT: opus decode hi fail — yehi asli dikkat hai."); return
    vals = struct.unpack("<%dh" % (len(decoded) // 2), bytes(decoded[:len(decoded)//2*2]))
    rms = int((sum(v * v for v in vals) / max(1, len(vals))) ** 0.5)
    print("   awaaz level rms =", rms, "(300-4000 saaf boli hoti hai)")
    # 4) Bot ka keyless Google STT path chalao
    wav16 = b._pcm_to_wav(bytes(decoded))
    transcript = ""
    try: transcript = await b._stt_first_try(wav16)
    except Exception as e: print("   Google STT error:", type(e).__name__, e)
    print("4) Google-free STT ne suna:", repr(transcript))
    print()
    if transcript:
        print("RESULT: STT chain SAHI hai — asli VC me dikkat awaaz ke packets/decode ki ho sakti hai.")
    else:
        print("RESULT: STT ne transcript nahi diya — network ya awaaz ki quality check karo.")
    print("Bolna tha:", repr(LINE))

asyncio.run(main())
