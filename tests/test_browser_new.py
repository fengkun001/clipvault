"""浏览器验证：自定义选项 UI + 图片在线预览（需先 pip install playwright && playwright install chromium）"""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("BASE", "http://127.0.0.1:8000")
TEST_IMAGE = os.path.join(os.path.dirname(__file__), "test_image.png")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/")
    page.wait_for_timeout(500)

    # 1. 选择自定义有效期 → 输入框应出现
    page.select_option("#expiry", "custom")
    page.wait_for_timeout(200)
    visible = page.eval_on_selector("#expiryCustom", "el => !el.hidden")
    print(f"1) 自定义有效期输入框出现: {'✅' if visible else '❌'}")

    # 2. 填 45 分钟 + 自定义次数 3
    page.fill("#expiryValue", "45")
    page.select_option("#expiryUnit", "60")
    page.select_option("#maxViews", "custom")
    page.fill("#viewsValue", "3")
    page.fill("#content", "自定义参数浏览器测试")
    page.click("#shareBtn")
    page.wait_for_timeout(1200)
    link = (page.text_content("#shareLink") or "").strip()
    meta_v = page.text_content("#metaViews")
    meta_e = page.text_content("#metaExpiry")
    print(f"2) 创建成功: {link}")
    print(f"   元信息: 次数={meta_v} 有效期至={meta_e}")

    # 3. 文件模式上传图片 → 查看页应内联预览
    page.click('button.tab[data-tab="file"]')
    page.set_input_files("#fileInput", TEST_IMAGE)
    page.wait_for_timeout(200)
    page.click("#shareBtn")
    page.wait_for_timeout(1500)
    file_link = (page.text_content("#shareLink") or "").strip()
    print(f"3) 图片分享链接: {file_link}")

    page2 = browser.new_page()
    page2.on("pageerror", lambda e: errors.append("view: " + str(e)))
    page2.goto(file_link)
    page2.wait_for_timeout(1500)
    preview_visible = page2.eval_on_selector("#filePreview", "el => !el.hidden")
    img_count = page2.eval_on_selector("#filePreview", "el => el.querySelectorAll('img').length")
    views_badge = page2.text_content("#fileViewsBadge")
    print(f"4) 图片内联预览: {'✅' if preview_visible and img_count == 1 else '❌'} (img={img_count}) 计数={views_badge.strip()}")

    # 5. 点击下载按钮（应走 blob，不再消耗次数）
    page2.click("#downloadBtn")
    page2.wait_for_timeout(500)
    toast = page2.text_content("#toast")
    print(f"5) 预览后下载: toast={toast.strip()}")

    print("6) 页面 JS 错误:", errors if errors else "无 ✅")
    browser.close()
