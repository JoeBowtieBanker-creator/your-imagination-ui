"""Capture README screenshots of the running local UI."""
from pathlib import Path
import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.edge.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
URL = "http://127.0.0.1:7860/?shot=1"
W, H = 1600, 1000

CLEAN_JS = r"""
(() => {
  const hide = (el) => { if (el) el.style.display = 'none'; };
  hide(document.getElementById('toast'));
  const strip = document.getElementById('strip');
  if (strip) strip.innerHTML = '';
  document.body.classList.add('rail-off');
  document.querySelectorAll('#frame img, #frame video, .live-preview').forEach((el) => {
    el.removeAttribute('src');
    el.hidden = true;
    el.style.display = 'none';
  });
  const ph = document.getElementById('placeholder');
  if (ph) { ph.hidden = false; ph.style.display = ''; }
  const nsfw = document.getElementById('nsfwChip');
  if (nsfw) nsfw.classList.remove('on');
  const hint = document.getElementById('filmHint');
  if (hint) {
    hint.textContent = 'A start still on a clip is that shot’s first frame. An empty start still continues from the previous clip.';
  }
  document.querySelectorAll('.film-ref img, .film-clip img, #refSlots img, #galGrid img').forEach((el) => {
    el.removeAttribute('src');
    el.style.visibility = 'hidden';
  });
  document.querySelectorAll('.film-ref').forEach((el) => el.classList.remove('filled'));
})();
"""

RESET_JS = r"""
(() => {
  try {
    localStorage.removeItem('yi-film');
    localStorage.removeItem('yi-refs');
    localStorage.removeItem('yi-char-lib');
  } catch (e) {}
})();
"""


def hide_chrome(driver):
    driver.execute_script(CLEAN_JS)


def shot(driver, name):
    hide_chrome(driver)
    time.sleep(0.2)
    path = OUT / name
    driver.save_screenshot(str(path))
    print("wrote", path, path.stat().st_size)


def click(driver, css, timeout=8):
    el = WebDriverWait(driver, timeout).until(EC.element_to_be_clickable((By.CSS_SELECTOR, css)))
    driver.execute_script("arguments[0].click();", el)
    time.sleep(0.45)


def main():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument(f"--window-size={W},{H}")
    opts.add_argument("--hide-scrollbars")
    opts.add_argument("--force-device-scale-factor=1")
    driver = webdriver.Edge(options=opts)
    driver.set_window_size(W, H)
    try:
        driver.get(URL)
        driver.execute_script(RESET_JS)
        driver.get(URL)
        WebDriverWait(driver, 12).until(EC.presence_of_element_located((By.CSS_SELECTOR, ".composer")))
        try:
            WebDriverWait(driver, 18).until(
                lambda d: d.find_element(By.ID, "packName").text.strip() not in ("", "Choose a model")
            )
        except Exception:
            pass
        time.sleep(0.8)
        hide_chrome(driver)

        click(driver, '[data-mode="image"]')
        time.sleep(0.35)
        shot(driver, "t2i.png")

        click(driver, '[data-mode="ref_image"]')
        time.sleep(0.45)
        shot(driver, "r2i.png")

        click(driver, '[data-mode="video"]')
        time.sleep(0.45)
        shot(driver, "video.png")

        click(driver, '[data-mode="edit"]')
        time.sleep(0.45)
        shot(driver, "edit.png")

        click(driver, '[data-mode="image"]')
        click(driver, "#filmBtn")
        time.sleep(0.6)
        shot(driver, "film.png")
        click(driver, "#closeFilm")
        time.sleep(0.35)

        click(driver, "#packChip")
        time.sleep(0.45)
        foot = driver.find_elements(By.CSS_SELECTOR, "#packMenu .pm-foot")
        if foot:
            driver.execute_script("arguments[0].click();", foot[0])
            time.sleep(0.6)
            driver.execute_script(
                """
                document.querySelectorAll('#packGrid .card, #packList .card, #packGrid > *').forEach((el) => {
                  const t = (el.innerText || '');
                  if (/\\(mine\\)/i.test(t)) el.remove();
                });
                """
            )
            time.sleep(0.2)
            shot(driver, "packs.png")
            close = driver.find_elements(By.CSS_SELECTOR, "#closePacks")
            if close:
                driver.execute_script("arguments[0].click();", close[0])
        else:
            shot(driver, "packs.png")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
