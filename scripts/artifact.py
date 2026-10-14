"""Transforme le build autonome (dist-preview/index.html) en page publiable comme artifact."""
import re, sys
src = open('dist-preview/index.html', encoding='utf-8').read()
title = re.search(r'<title>.*?</title>', src, re.S).group(0)
head = re.search(r'<head>(.*?)</head>', src, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', src, re.S).group(1)
head = re.sub(r'<meta charset[^>]*>|<meta name="viewport"[^>]*>|<title>.*?</title>', '', head, flags=re.S)
out = f'{title}\n<meta name="claude:viewport-fit-sides" content="cover">\n{head.strip()}\n{body.strip()}\n'
open(sys.argv[1], 'w', encoding='utf-8').write(out)
print(len(out))
