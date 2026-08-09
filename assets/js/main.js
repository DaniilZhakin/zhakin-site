document.addEventListener('DOMContentLoaded', () => {
  const links = document.querySelectorAll('.main-navigation a[href^="#"]');
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('.main-navigation');

  const setMenuState = (isOpen) => {
    if (!navigation || !menuButton) return;

    navigation.classList.toggle('active', isOpen);
    menuButton.classList.toggle('active', isOpen);
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
  };

  if (menuButton && navigation) {
    menuButton.addEventListener('click', () => {
      const isOpen = navigation.classList.contains('active');
      setMenuState(!isOpen);
    });
  }

  links.forEach(link => {
    link.addEventListener('click', event => {
      const target = document.querySelector(link.getAttribute('href'));

      if (target) {
        event.preventDefault();
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });

        setMenuState(false);
      }
    });
  });

  document.addEventListener('click', event => {
    if (!navigation || !menuButton) return;

    const clickedInsideMenu = navigation.contains(event.target);
    const clickedButton = menuButton.contains(event.target);

    if (!clickedInsideMenu && !clickedButton) {
      setMenuState(false);
    }
  });
});