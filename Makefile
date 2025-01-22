GETTEXT_PACKAGE = herkul@faymaz.github.com
MSGINIT = msginit
MSGMERGE = msgmerge
MSGFMT = msgfmt
XGETTEXT = xgettext

LINGUAS = $(shell cat po/LINGUAS)
POTFILE = po/$(GETTEXT_PACKAGE).pot
POFILES = $(addprefix po/,$(addsuffix .po,$(LINGUAS)))
MOFILES = $(addprefix locale/,$(LINGUAS))

.PHONY: all clean potfile update-po update-mo install

all: update-mo

potfile: $(POTFILE)

$(POTFILE):
	mkdir -p po
	$(XGETTEXT) --from-code=UTF-8 \
		--add-comments=TRANSLATORS: \
		--package-name=$(GETTEXT_PACKAGE) \
		--output=$@ \
		extension.js prefs.js

update-po: potfile
	for lang in $(LINGUAS); do \
		mkdir -p po/$$lang/LC_MESSAGES; \
		if [ -f po/$$lang.po ]; then \
			$(MSGMERGE) -U po/$$lang.po $(POTFILE); \
		else \
			$(MSGINIT) -i $(POTFILE) -o po/$$lang.po -l $$lang; \
		fi \
	done

update-mo: update-po
	for lang in $(LINGUAS); do \
		mkdir -p locale/$$lang/LC_MESSAGES; \
		$(MSGFMT) -o locale/$$lang/LC_MESSAGES/$(GETTEXT_PACKAGE).mo po/$$lang.po; \
	done

clean:
	rm -rf locale
	rm -f po/*.mo
	rm -f po/*.pot