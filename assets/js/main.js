document.addEventListener('DOMContentLoaded', () => {
  const links = document.querySelectorAll('.main-navigation a[href^="#"]');
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('.main-navigation');

  if (menuButton && navigation) {
    menuButton.addEventListener('click', () => {
      navigation.classList.toggle('active');
      menuButton.classList.toggle('active');
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

        if (navigation) navigation.classList.remove('active');
        if (menuButton) menuButton.classList.remove('active');
      }
    });
  });

  document.addEventListener('click', event => {
    if (!navigation || !menuButton) return;

    const clickedInsideMenu = navigation.contains(event.target);
    const clickedButton = menuButton.contains(event.target);

    if (!clickedInsideMenu && !clickedButton) {
      navigation.classList.remove('active');
      menuButton.classList.remove('active');
    }
  });
});