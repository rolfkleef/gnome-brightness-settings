test:
	for f in tests/*.test.js; do gjs -m $$f || exit 1; done

install:
	ln -sfn $(CURDIR) ~/.local/share/gnome-shell/extensions/display-settings@drostan.org
